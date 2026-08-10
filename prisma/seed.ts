import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Closed Friday 5pm -> Saturday 6pm for the Sabbath; admin can edit these later
// as sunset drifts.
const BUSINESS_HOURS = [
  { weekday: 0, openMin: 480, closeMin: 1320 }, // Sun 8am-10pm
  { weekday: 1, openMin: 480, closeMin: 1320 }, // Mon 8am-10pm
  { weekday: 2, openMin: 480, closeMin: 1320 }, // Tue 8am-10pm
  { weekday: 3, openMin: 480, closeMin: 1320 }, // Wed 8am-10pm
  { weekday: 4, openMin: 480, closeMin: 1320 }, // Thu 8am-10pm
  { weekday: 5, openMin: 480, closeMin: 1020 }, // Fri 8am-5pm
  { weekday: 6, openMin: 1080, closeMin: 1320 }, // Sat 6pm-10pm
];

// ₱200/hr on weekday daytimes, ₱300/hr on evenings and all of Sunday. Every
// band is pinned to a weekday because the two rates overlap in clock time —
// Sunday 8am is peak while Monday 8am is not.
const PRICE_TIERS = [
  { weekday: 0, startMin: 480, endMin: 1320, priceCentsPerHour: 30000 }, // Sun 8am-10pm
  { weekday: 1, startMin: 480, endMin: 960, priceCentsPerHour: 20000 }, // Mon 8am-4pm
  { weekday: 2, startMin: 480, endMin: 960, priceCentsPerHour: 20000 }, // Tue 8am-4pm
  { weekday: 3, startMin: 480, endMin: 960, priceCentsPerHour: 20000 }, // Wed 8am-4pm
  { weekday: 4, startMin: 480, endMin: 960, priceCentsPerHour: 20000 }, // Thu 8am-4pm
  { weekday: 5, startMin: 480, endMin: 960, priceCentsPerHour: 20000 }, // Fri 8am-4pm
  { weekday: 1, startMin: 960, endMin: 1320, priceCentsPerHour: 30000 }, // Mon 4pm-10pm
  { weekday: 2, startMin: 960, endMin: 1320, priceCentsPerHour: 30000 }, // Tue 4pm-10pm
  { weekday: 3, startMin: 960, endMin: 1320, priceCentsPerHour: 30000 }, // Wed 4pm-10pm
  { weekday: 4, startMin: 960, endMin: 1320, priceCentsPerHour: 30000 }, // Thu 4pm-10pm
  { weekday: 5, startMin: 960, endMin: 1020, priceCentsPerHour: 30000 }, // Fri 4pm-5pm
  { weekday: 6, startMin: 1080, endMin: 1320, priceCentsPerHour: 30000 }, // Sat 6pm-10pm
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

  const existingTiers = await prisma.priceTier.count();
  if (existingTiers === 0) {
    await prisma.priceTier.createMany({ data: PRICE_TIERS });
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
