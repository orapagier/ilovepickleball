-- AlterEnum
ALTER TYPE "PayMethod" ADD VALUE 'bdo';
ALTER TYPE "PayMethod" ADD VALUE 'qrph';

-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "bdoAccountName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bdoAccountNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "qrphAccountName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "qrphAccountNumber" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "PriceTier" (
    "id" SERIAL NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "priceCentsPerHour" INTEGER NOT NULL,

    CONSTRAINT "PriceTier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceTier_startMin_idx" ON "PriceTier"("startMin");
