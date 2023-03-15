import * as dotenv from "dotenv";
dotenv.config();
import fastify from "fastify";
import multipart, { MultipartFile } from "@fastify/multipart";

import { createClient } from "redis";
import { nanoid } from "nanoid";

const client = createClient({
  url:
    process.env.REDIS_URL +
    "@" +
    process.env.REDISHOST +
    ":" +
    process.env.REDISPORT,
});

const server = fastify({ logger: process.env.NODENV !== "production" });
server.register(multipart);

server.get("uptime", (req, reply) => {
  reply.send({ time: process.uptime() });
});

type FileInfo = {
  length: number;
} & Omit<MultipartFile, "file" | "toBuffer" | "type">;

server.post("/upload", async (req, reply) => {
  const file = await req.file();
  if (!file) return;

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
    fields: file.fields,
    length: chunks.length,
    mimetype: file.mimetype,
    filename: file.filename,
  };

  await client.set(`${id}`, JSON.stringify(infos));

  chunks.forEach(async (chunk, index) => {
    await client.set(`${id}|${index}`, chunk.toString());
  });

  reply.status(200).send({ id: id });
});

server.get("/file/:id", async (req, reply) => {
  const id = (req.params as { id: string }).id;
  if (!id) return;

  const f = await client.get(`${id}`);
  if (!f) return;

  const infos = JSON.parse(f) as FileInfo;

  const keys = Array(infos.length)
    .fill(null)
    .map((_, index) => `${id}|${index}`);

  const chunks = (await client.mGet(keys))
    .filter((c) => Boolean(c))
    .map((s) => Buffer.from(s!));

  const chunk = Buffer.concat(chunks);
  reply.header(
    "Content-Disposition",
    `attachment; filename="${infos.filename}"`
  );

  reply.type(infos.mimetype);

  reply.status(200).send(chunk);
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
