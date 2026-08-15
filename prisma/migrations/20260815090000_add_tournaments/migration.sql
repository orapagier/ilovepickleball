-- CreateEnum
CREATE TYPE "TournamentFormat" AS ENUM ('single_elimination', 'round_robin');

-- CreateEnum
CREATE TYPE "TournamentPlayType" AS ENUM ('singles', 'doubles');

-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('draft', 'registration_open', 'registration_closed', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('registered', 'waitlisted', 'withdrawn', 'checked_in', 'no_show');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('pending', 'ready', 'in_progress', 'completed', 'walkover');

-- CreateEnum
CREATE TYPE "MatchSlot" AS ENUM ('A', 'B');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "tournamentId" TEXT;

-- CreateTable
CREATE TABLE "Tournament" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "format" "TournamentFormat" NOT NULL,
    "playType" "TournamentPlayType" NOT NULL,
    "skillLevel" TEXT NOT NULL DEFAULT '',
    "maxEntries" INTEGER NOT NULL,
    "minEntries" INTEGER NOT NULL,
    "entryFeeCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "registrationOpensAt" TIMESTAMPTZ(3),
    "registrationClosesAt" TIMESTAMPTZ(3) NOT NULL,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "estimatedEndAt" TIMESTAMPTZ(3),
    "status" "TournamentStatus" NOT NULL DEFAULT 'draft',
    "prizeDescription" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentCourt" (
    "tournamentId" TEXT NOT NULL,
    "courtId" INTEGER NOT NULL,

    CONSTRAINT "TournamentCourt_pkey" PRIMARY KEY ("tournamentId","courtId")
);

-- CreateTable
CREATE TABLE "Registration" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "player1Id" TEXT NOT NULL,
    "player2Id" TEXT,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'registered',
    "seed" INTEGER,
    "feePaid" BOOLEAN NOT NULL DEFAULT false,
    "registeredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "matchNumber" INTEGER NOT NULL,
    "sideARegistrationId" TEXT,
    "sideBRegistrationId" TEXT,
    "courtId" INTEGER,
    "status" "MatchStatus" NOT NULL DEFAULT 'pending',
    "scheduledAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "score" TEXT NOT NULL DEFAULT '',
    "winnerRegistrationId" TEXT,
    "nextMatchId" TEXT,
    "nextMatchSlot" "MatchSlot",

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tournament_status_idx" ON "Tournament"("status");

-- CreateIndex
CREATE INDEX "Tournament_startAt_idx" ON "Tournament"("startAt");

-- CreateIndex
CREATE INDEX "TournamentCourt_courtId_idx" ON "TournamentCourt"("courtId");

-- CreateIndex
CREATE INDEX "Registration_tournamentId_status_idx" ON "Registration"("tournamentId", "status");

-- CreateIndex
CREATE INDEX "Registration_player1Id_idx" ON "Registration"("player1Id");

-- CreateIndex
CREATE INDEX "Registration_player2Id_idx" ON "Registration"("player2Id");

-- CreateIndex
CREATE UNIQUE INDEX "Registration_tournamentId_player1Id_key" ON "Registration"("tournamentId", "player1Id");

-- CreateIndex
CREATE INDEX "Match_tournamentId_status_idx" ON "Match"("tournamentId", "status");

-- CreateIndex
CREATE INDEX "Match_courtId_idx" ON "Match"("courtId");

-- CreateIndex
CREATE UNIQUE INDEX "Match_tournamentId_round_matchNumber_key" ON "Match"("tournamentId", "round", "matchNumber");

-- CreateIndex
CREATE INDEX "Booking_tournamentId_idx" ON "Booking"("tournamentId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentCourt" ADD CONSTRAINT "TournamentCourt_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentCourt" ADD CONSTRAINT "TournamentCourt_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_player1Id_fkey" FOREIGN KEY ("player1Id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_player2Id_fkey" FOREIGN KEY ("player2Id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_sideARegistrationId_fkey" FOREIGN KEY ("sideARegistrationId") REFERENCES "Registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_sideBRegistrationId_fkey" FOREIGN KEY ("sideBRegistrationId") REFERENCES "Registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_winnerRegistrationId_fkey" FOREIGN KEY ("winnerRegistrationId") REFERENCES "Registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_nextMatchId_fkey" FOREIGN KEY ("nextMatchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

