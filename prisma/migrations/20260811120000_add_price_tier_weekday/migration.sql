-- AlterTable
-- Nullable on purpose: an existing tier keeps applying to every day.
ALTER TABLE "PriceTier" ADD COLUMN     "weekday" INTEGER;
