import { generateKeyPairSync } from "node:crypto";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
(globalThis as any).__TEST_PEM__ = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
