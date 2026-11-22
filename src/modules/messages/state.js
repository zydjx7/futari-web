export const other = member => member === "her" ? "admin" : "her";
export const who = (author, member) => author === member ? "我" : author === "her" ? "她" : "他";
export const unreadCondition = "NOT EXISTS(SELECT 1 FROM book_note_reads r WHERE r.member=?2 AND r.note_id=n.id)";
export function unreadCount(ctx) {
  return ctx.db.prepare("SELECT count(*) AS n FROM book_notes n WHERE n.author=?1 AND "+unreadCondition)
    .bind(other(ctx.role),ctx.role).first("n");
}
export const noteURL = n => `/novels/${n.book_id}?chapter=${n.chapter}#note-p-${n.paragraph}`;
