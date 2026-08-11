/** Confirm-dialog wording for deleting a user, shared by the list and detail
 *  views. It spells out what goes with the account — bookings and payment
 *  records are removed alongside it — and that deletion isn't a ban, since
 *  signing in again with the same Google account just creates a fresh row. */
export function deleteUserMessage(label: string, isAdmin: boolean, bookings: number): string {
  const records =
    bookings === 0 ? "" : ` and their ${bookings} booking ${bookings === 1 ? "record" : "records"} (with any payment details)`;
  const adminNote = isAdmin ? " This account has admin access." : "";
  return (
    `Permanently delete ${label}${records}?${adminNote} This cannot be undone — ` +
    "though signing in again with the same Google account creates a new customer record."
  );
}
