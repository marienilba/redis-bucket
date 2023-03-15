"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const fastify_1 = __importDefault(require("fastify"));
const multipart_1 = __importDefault(require("@fastify/multipart"));
const redis_1 = require("redis");
const nanoid_1 = require("nanoid");
const client = (0, redis_1.createClient)({
    url: process.env.REDIS_URL +
        "@" +
        process.env.REDISHOST +
        ":" +
        process.env.REDISPORT,
});
const server = (0, fastify_1.default)({ logger: process.env.NODENV !== "production" });
server.register(multipart_1.default);
server.post("/upload", async (req, reply) => {
    const file = await req.file();
    if (!file)
        return;
    const id = (0, nanoid_1.nanoid)();
    const buffer = await file.toBuffer();
    const maxChunkSize = 512 * 1024 * 1024; // 512Mb in bytes
    const chunks = [];
    let offset = 0;
    while (offset < buffer.length) {
        const chunkSize = Math.min(maxChunkSize, buffer.length - offset);
        const chunk = Buffer.allocUnsafe(chunkSize);
        buffer.copy(chunk, 0, offset, offset + chunkSize);
        chunks.push(chunk);
        offset += chunkSize;
    }
    const infos = {
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
    const id = req.params.id;
    if (!id)
        return;
    const f = await client.get(`${id}`);
    if (!f)
        return;
    const infos = JSON.parse(f);
    const keys = Array(infos.length)
        .fill(null)
        .map((_, index) => `${id}|${index}`);
    const chunks = (await client.mGet(keys))
        .filter((c) => Boolean(c))
        .map((s) => Buffer.from(s));
    const chunk = Buffer.concat(chunks);
    reply.header("Content-Disposition", `attachment; filename="${infos.filename}"`);
    reply.type(infos.mimetype);
    reply.status(200).send(chunk);
});
server.listen({
    port: process.env.PORT ? parseInt(process.env.PORT) : 8080,
    host: process.env.HOST || "0.0.0.0",
}, (err, address) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`Server listening at ${address}`);
});
