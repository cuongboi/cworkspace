import type { DeepStrings } from "../ja/types"
import type { shell as en } from "../en/shell"

export const shell: DeepStrings<typeof en> = {
  back: "Quay lại",
  forward: "Tiến",
  contacts: "Liên hệ",
  inviteTeam: "Mời đồng đội của bạn để bắt đầu.",
  search: {
    trigger: "Tìm kiếm",
    description: "Tìm kiếm trong {{company}}",
    placeholder: "Tìm kiếm trong {{company}}…",
    tabs: {
      all: "Tất cả kết quả",
      user: "Mọi người",
      group: "Nhóm",
      post: "Bài viết",
      message: "Tin nhắn",
      file: "Tệp",
    },
    minChars: "Nhập ít nhất {{count}} ký tự để tìm kiếm.",
    recent: "Tìm kiếm gần đây",
    today: "Hôm nay",
    yesterday: "Hôm qua",
    noResultsFor: "Không có kết quả cho “{{q}}”.",
    searchAll: "Tìm mọi thứ cho “{{q}}”",
  },
  searchPage: {
    resultsFor: "Kết quả cho “{{q}}”",
    emptyTitle: "Tìm kiếm trong nơi làm việc",
    emptyDescription: "Tìm mọi người, nhóm và bài viết trong toàn công ty.",
    placeholder: "Tìm mọi người, nhóm và bài viết",
    noPeople: "Không tìm thấy ai.",
    noGroups: "Không tìm thấy nhóm nào.",
    noPosts: "Không tìm thấy bài viết nào.",
  },
}
