import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Sun-Thu: open all day. Fri: open until 4pm. Sat: open from 6pm.
// Reproduces "open Sat 6pm -> Fri 4pm, closed Fri sunset -> Sat sunset" as a
// continuous weekly window; admin can edit these later as sunset drifts.
const BUSINESS_HOURS = [
  { weekday: 0, openMin: 0, closeMin: 1440 }, // Sun
  { weekday: 1, openMin: 0, closeMin: 1440 }, // Mon
  { weekday: 2, openMin: 0, closeMin: 1440 }, // Tue
  { weekday: 3, openMin: 0, closeMin: 1440 }, // Wed
  { weekday: 4, openMin: 0, closeMin: 1440 }, // Thu
  { weekday: 5, openMin: 0, closeMin: 960 }, // Fri, until 16:00
  { weekday: 6, openMin: 1080, closeMin: 1440 }, // Sat, from 18:00
];

async function main() {
  await prisma.setting.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });

  const existingHours = await prisma.businessHour.count();
  if (existingHours === 0) {
    await prisma.businessHour.createMany({ data: BUSINESS_HOURS });
  }

  const existingCourts = await prisma.court.count();
  if (existingCourts === 0) {
    await prisma.court.createMany({
      data: [
        { name: "Court 1", sortOrder: 1 },
        { name: "Court 2", sortOrder: 2 },
      ],
    });
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
