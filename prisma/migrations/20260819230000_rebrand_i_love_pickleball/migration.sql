-- Rebrand: "Smash Zone Pickleball Tagum" is now "I Love Pickleball", and the
-- club's contact is its owner. The live row is rewritten here rather than left
-- to the settings form, so every environment lands on the new name on deploy.
ALTER TABLE "Setting" ALTER COLUMN "businessName" SET DEFAULT 'I Love Pickleball';

UPDATE "Setting"
SET "businessName"  = 'I Love Pickleball',
    "contactPerson" = 'Jelmar Orapa',
    "contactPhone"  = '09631225067',
    "contactEmail"  = 'orapajelmar@gmail.com'
WHERE "id" = 1;

-- One admin account from here: the owner's. Anyone else who needs it is
-- promoted from /admin/users.
UPDATE "User"
SET "role" = 'customer'
WHERE "role" = 'admin' AND lower("email") <> 'orapajelmar@gmail.com';
