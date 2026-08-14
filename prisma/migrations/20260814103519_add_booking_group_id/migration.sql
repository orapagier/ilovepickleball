-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "groupId" TEXT;

-- CreateIndex
CREATE INDEX "Booking_groupId_idx" ON "Booking"("groupId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
