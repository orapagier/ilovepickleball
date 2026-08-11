-- AlterTable
-- Empty string rather than NULL: "no calendar mapped" and "not yet mirrored"
-- are the normal state for every existing row, not missing information.
ALTER TABLE "Court" ADD COLUMN     "googleCalendarId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "googleEventId" TEXT NOT NULL DEFAULT '';
