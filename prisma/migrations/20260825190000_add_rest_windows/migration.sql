-- The Sabbath stops being a constant in the source and becomes the club's own
-- setting. `SABBATH_START`/`SABBATH_END` hardcoded Friday 5 PM → Saturday 6 PM,
-- which only ever suited a seventh-day congregation; a club that rests Sunday
-- morning, or not at all, had no way to say so.
--
-- The window is enforced over the business hours rather than beside them, so
-- one row is now the whole truth about a weekly rest.
CREATE TABLE "RestWindow" (
    "id"           SERIAL       NOT NULL,
    "startWeekday" INTEGER      NOT NULL,
    "startMinute"  INTEGER      NOT NULL,
    "endWeekday"   INTEGER      NOT NULL,
    "endMinute"    INTEGER      NOT NULL,
    "label"        TEXT         NOT NULL DEFAULT 'Rest',
    "noteTitle"    TEXT         NOT NULL DEFAULT '',
    "noteBody"     TEXT         NOT NULL DEFAULT '',
    "quote"        TEXT         NOT NULL DEFAULT '',
    "quoteSource"  TEXT         NOT NULL DEFAULT '',
    "sortOrder"    INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT "RestWindow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RestWindow_sortOrder_idx" ON "RestWindow"("sortOrder");

-- Carry the behaviour that was in the code across, so this deployment wakes up
-- keeping the same Sabbath it kept yesterday, with the same words on /book.
INSERT INTO "RestWindow"
    ("startWeekday", "startMinute", "endWeekday", "endMinute", "label", "noteTitle", "noteBody", "quote", "quoteSource", "sortOrder")
VALUES (
    5, 1020, 6, 1080,
    'Sabbath',
    'Closed for the Sabbath',
    'We keep the seventh day as a day of rest and worship, so no courts are booked then. The hours shown are the ones outside that — we''d love to have you then.',
    'Remember the sabbath day, to keep it holy. Six days shalt thou labour, and do all thy work: but the seventh day is the sabbath of the LORD thy God: in it thou shalt not do any work.',
    'Exodus 20:8–10 (KJV)',
    0
);
