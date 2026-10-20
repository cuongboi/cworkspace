import type { DeepStrings } from "../ja/types"
import type { notifications as en } from "../en/notifications"

export const notifications: DeepStrings<typeof en> = {
  title: "Thông báo",
  bellLabel_one: "Thông báo ({{count}} chưa đọc)",
  bellLabel_other: "Thông báo ({{count}} chưa đọc)",
  view: "Xem",
  markAllRead: "Đánh dấu tất cả là đã đọc",
  markAllFailed: "Không thể đánh dấu thông báo là đã đọc",
  caughtUp: "Bạn đã xem hết thông báo",
  caughtUpBody:
    "Lượt nhắc đến, bình luận, lời mời và lời nhắc sẽ hiển thị ở đây.",
  filterLabel: "Lọc thông báo",
  all: "Tất cả",
  unread: "Chưa đọc",
  loadFailed: "Không thể tải thông báo",
  noUnread: "Không có thông báo chưa đọc",
  none: "Chưa có thông báo nào",
  noneBody:
    "Khi ai đó nhắc đến bạn, bình luận về bài viết của bạn, mời bạn tham gia sự kiện hoặc gọi cho bạn, bạn sẽ thấy ở đây.",
  end: "Đã hết thông báo.",
  unreadDot: "Chưa đọc",
  options: "Tùy chọn thông báo",
  markRead: "Đánh dấu là đã đọc",
  markUnread: "Đánh dấu là chưa đọc",
  remove: "Gỡ thông báo",
  someone: "Ai đó",
  aGroup: "một nhóm",
  anEvent: "một sự kiện",
  text: {
    mentionChat: "<b>{{actor}}</b> đã nhắc đến bạn trong một cuộc trò chuyện",
    mentionComment: "<b>{{actor}}</b> đã nhắc đến bạn trong một bình luận",
    mentionPost: "<b>{{actor}}</b> đã nhắc đến bạn trong một bài viết",
    postComment: "<b>{{actor}}</b> đã bình luận về bài viết của bạn",
    commentReply: "<b>{{actor}}</b> đã trả lời bình luận của bạn",
    postReaction:
      "<b>{{actor}}</b> đã bày tỏ cảm xúc {{emoji}} về bài viết của bạn",
    groupPost: "<b>{{actor}}</b> đã đăng trong <b>{{group}}</b>",
    joinRequest: "<b>{{actor}}</b> đã yêu cầu tham gia <b>{{group}}</b>",
    joinApproved: "Yêu cầu tham gia <b>{{group}}</b> của bạn đã được phê duyệt",
    eventInvite: "<b>{{actor}}</b> đã mời bạn tham gia <b>{{event}}</b>",
    eventReminder: "Sự kiện sắp bắt đầu: <b>{{event}}</b>",
    missedCall: "Cuộc gọi nhỡ từ <b>{{actor}}</b>",
    other: "Hoạt động mới từ <b>{{actor}}</b>",
  },
  pwa: {
    update: "Đã có phiên bản mới",
    reload: "Tải lại",
  },
}
