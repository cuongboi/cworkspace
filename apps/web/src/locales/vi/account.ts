import type { DeepStrings } from "../ja/types"
import type { account as en } from "../en/account"

export const account: DeepStrings<typeof en> = {
  menu: "Tài khoản",
  profile: "Trang cá nhân",
  theme: "Giao diện",
  light: "Sáng",
  dark: "Tối",
  system: "Theo hệ thống",
  language: "Ngôn ngữ",
  installApp: "Cài đặt ứng dụng",
  installHint: "Nhấn Chia sẻ, rồi chọn “Thêm vào MH chính”.",
  signOut: "Đăng xuất",
  settings: "Cài đặt tài khoản",
  page: {
    title: "Cài đặt tài khoản",
    subtitle: "Quản lý mật khẩu, thiết bị đang đăng nhập và thông báo.",
    tabs: {
      security: "Bảo mật",
      notifications: "Thông báo",
      preferences: "Tuỳ chọn",
    },
  },
  password: {
    title: "Đổi mật khẩu",
    description:
      "Dùng ít nhất 8 ký tự. Tránh dùng lại mật khẩu của dịch vụ khác.",
    current: "Mật khẩu hiện tại",
    new: "Mật khẩu mới",
    confirm: "Xác nhận mật khẩu mới",
    show: "Hiện mật khẩu",
    hide: "Ẩn mật khẩu",
    signOutOthers: "Đăng xuất khỏi tất cả thiết bị khác",
    signOutOthersHint:
      "Nên bật nếu bạn nghĩ người khác đã biết mật khẩu của bạn.",
    submit: "Cập nhật mật khẩu",
    updated: "Đã cập nhật mật khẩu",
    tooShort: "Dùng ít nhất 8 ký tự",
    mismatch: "Mật khẩu không khớp",
    sameAsCurrent: "Hãy chọn mật khẩu khác với mật khẩu hiện tại",
    wrongCurrent: "Mật khẩu hiện tại không đúng",
    failed: "Không thể cập nhật mật khẩu",
  },
  sessions: {
    title: "Nơi bạn đang đăng nhập",
    description:
      "Các thiết bị đã đăng nhập vào tài khoản của bạn. Hãy đăng xuất thiết bị bạn không nhận ra.",
    thisDevice: "Thiết bị này",
    activeNow: "Đang hoạt động",
    lastActive: "Hoạt động {{time}}",
    signedIn: "Đăng nhập {{date}}",
    unknownIp: "IP không xác định",
    unknownDevice: "Thiết bị không xác định",
    browserOn: "{{browser}} trên {{os}}",
    revoke: "Đăng xuất",
    revoked: "Đã đăng xuất thiết bị",
    revokeAll: "Đăng xuất tất cả thiết bị khác",
    revokeAllTitle: "Đăng xuất tất cả thiết bị khác?",
    revokeAllBody:
      "Mọi trình duyệt và ứng dụng khác đang đăng nhập tài khoản của bạn sẽ bị đăng xuất trong vòng một phút. Thiết bị này vẫn được giữ đăng nhập.",
    revokedAll: "Đã đăng xuất khỏi tất cả thiết bị khác",
    onlyThis: "Bạn chỉ đang đăng nhập trên thiết bị này.",
    loadFailed: "Không thể tải danh sách phiên đăng nhập",
  },
  preferences: {
    languageDescription: "Ngôn ngữ hiển thị của ứng dụng trên thiết bị này.",
    themeDescription: "Chọn giao diện của ứng dụng trên thiết bị này.",
  },
}
