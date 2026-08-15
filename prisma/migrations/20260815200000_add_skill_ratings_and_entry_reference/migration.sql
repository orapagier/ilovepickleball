-- AlterTable
ALTER TABLE "User" ADD COLUMN     "skillRating" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Registration" ADD COLUMN     "paymentReference" TEXT NOT NULL DEFAULT '';

-- AlterTable
-- The free-text `skillLevel` label is replaced by the bounds that are actually
-- enforced at entry; the label every view shows is derived from them instead.
ALTER TABLE "Tournament" ADD COLUMN     "minSkillRating" DOUBLE PRECISION,
ADD COLUMN     "maxSkillRating" DOUBLE PRECISION;

ALTER TABLE "Tournament" DROP COLUMN "skillLevel";
