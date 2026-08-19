import { config } from "dotenv";
config({ path: ".env.local" });
import { PrismaClient } from "./src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  console.log("COURTS", JSON.stringify(await prisma.court.findMany({ select: { id: true, name: true } })));
  const s = await prisma.setting.findFirst();
  console.log("SETTING", JSON.stringify({ businessName: s?.businessName, contactPerson: s?.contactPerson, contactPhone: s?.contactPhone, contactEmail: s?.contactEmail }));
  console.log("USERS", JSON.stringify(await prisma.user.findMany({ select: { email: true, name: true, role: true } })));
  await prisma.$disconnect();
}
main();
