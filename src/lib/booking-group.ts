/** The id every member of a checkout group is looked up by: the first booking
 *  created in that submit, whose own `groupId` stays null. A solo booking is
 *  its own anchor. See the `groupId` comment on the Booking model. */
export function resolveGroupAnchorId(booking: { id: string; groupId: string | null }): string {
  return booking.groupId ?? booking.id;
}
