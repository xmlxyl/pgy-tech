import { PrismaClient } from "@prisma/client";

/** @type {PrismaClient | undefined} */
let prismaGlobal;

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
  prismaGlobal = global.prismaGlobal;
}

const prisma = prismaGlobal ?? new PrismaClient();

export default prisma;
