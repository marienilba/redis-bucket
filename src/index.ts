import * as dotenv from "dotenv";
dotenv.config();
import fastify from "fastify";
import multipart, { MultipartFile } from "@fastify/multipart";
import cors from "@fastify/cors";

import { commandOptions, createClient } from "redis";
import { nanoid } from "nanoid";

const client = createClient({
  url: process.env.REDIS_URL,
});

client.connect();

const server = fastify({ logger: process.env.NODENV !== "production" });
server.register(multipart, {
  limits: {
    files: 1,
    fileSize: 1048576,
  },
});
server.register(cors, {
  origin: "*",
});

server.get("/uptime", (req, reply) => {
  reply.send({ time: process.uptime() });
});

type FileInfo = {
  length: number;
} & Omit<MultipartFile, "file" | "toBuffer" | "type" | "fields">;

server.post("/upload", async (req, reply) => {
  const file = await req.file();
  if (!file) {
    reply.status(400).send();
    return;
  }

  const id = nanoid();
  const buffer = await file.toBuffer();

  const maxChunkSize = 512 * 1024 * 1024; // 512Mb in bytes
  const chunks: Buffer[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const chunkSize = Math.min(maxChunkSize, buffer.length - offset);
    const chunk = Buffer.allocUnsafe(chunkSize);
    buffer.copy(chunk, 0, offset, offset + chunkSize);
    chunks.push(chunk);
    offset += chunkSize;
  }

  const infos: FileInfo = {
    encoding: file.encoding,
    fieldname: file.fieldname,
    length: chunks.length,
    mimetype: file.mimetype,
    filename: file.filename,
  };

  await client.set(`${id}`, JSON.stringify(infos));

  chunks.forEach(async (chunk, index) => {
    await client.set(`${id}|${index}`, chunk);
  });

  reply.status(200).send({ id: id });
});

server.get("/file/:id", async (req, reply) => {
  const id = (req.params as { id: string }).id;
  if (!id) {
    reply.status(400).send();
    return;
  }

  const f = await client.get(`${id}`);
  if (!f) {
    reply.status(400).send();
    return;
  }

  const infos = JSON.parse(f) as FileInfo;

  const keys = Array(infos.length)
    .fill(null)
    .map((_, index) => `${id}|${index}`);

  const chunks = (
    await client.mGet(
      commandOptions({
        returnBuffers: true,
      }),
      keys
    )
  ).filter((c) => Boolean(c)) as Buffer[];

  const chunk = Buffer.concat(chunks);
  reply.header(
    "Content-Disposition",
    `attachment; filename="${infos.filename}"`
  );

  reply.type(infos.mimetype);

  reply.status(200).send(chunk);
});

server.delete("/all", (req, reply) => {
  const key = JSON.parse(req.body as string).key as string;
  if (!key || key !== process.env.SECURITY_KEY) {
    reply.status(400).send();
  }

  client.flushAll();
});

server.listen(
  {
    port: process.env.PORT ? parseInt(process.env.PORT) : 8080,
    host: process.env.HOST || "0.0.0.0",
  },
  (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`Server listening at ${address}`);
  }
);
