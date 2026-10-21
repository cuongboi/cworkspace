import type { DeepStrings } from "../ja/types"
import type { onboarding as en } from "../en/onboarding"

export const onboarding: DeepStrings<typeof en> = {
  pageTitle: "Thiết lập không gian làm việc",
  title: "Chào mừng! Hãy thiết lập không gian làm việc",
  steps: {
    account: "Tài khoản quản trị",
    workspace: "Không gian làm việc",
    services: "Dịch vụ",
  },
  stepOf: "Bước {{step}}/{{total}}",
  crossOrigin:
    "Cần hoàn tất thiết lập từ chính địa chỉ của máy chủ này. Hãy mở trực tiếp liên kết thiết lập.",
  next: "Tiếp tục",
  back: "Quay lại",
  skip: "Để sau",
  finish: "Tạo không gian làm việc",
  finishing: "Đang tạo…",
  token: {
    title: "Mở liên kết thiết lập",
    body: "Để bảo mật, cần liên kết được in ra console của máy chủ khi khởi động mà chưa có người dùng. Hãy mở liên kết đó hoặc dán mã từ liên kết.",
    label: "Mã thiết lập",
    submit: "Tiếp tục",
    invalid:
      "Liên kết thiết lập không còn hợp lệ. Khởi động lại máy chủ để có liên kết mới, hoặc kiểm tra ONBOARDING_TOKEN.",
  },
  account: {
    body: "Bạn sẽ là quản trị viên: quản lý mọi người, cài đặt và mọi nhóm.",
    name: "Tên của bạn",
    email: "Email",
    password: "Mật khẩu",
    passwordHint: "Ít nhất 8 ký tự. Cụm mật khẩu dài là tốt nhất.",
    confirm: "Xác nhận mật khẩu",
    weak: "Dùng ít nhất 8 ký tự",
    mismatch: "Mật khẩu không khớp",
    sameAsEmail: "Đừng dùng email làm mật khẩu",
    strength: { weak: "Yếu", fair: "Trung bình", strong: "Mạnh" },
  },
  workspace: {
    body: "Cách công ty hiển thị với mọi người. Bạn có thể đổi sau trong Cài đặt.",
    name: "Tên công ty hoặc không gian làm việc",
    description: "Mô tả ngắn",
  },
  services: {
    body: "Không bắt buộc. Thêm ngay hoặc sau trong Cài đặt.",
    captions: "Phụ đề trực tiếp trong cuộc gọi",
    provider: "Dịch vụ",
    apiKey: "API key",
    email: "Email (Resend)",
    emailBody:
      "Lời mời và đặt lại mật khẩu. Không có key thì email chỉ được in ra console máy chủ.",
    resendKey: "Resend API key",
    from: "Người gửi",
  },
  done: "Không gian làm việc đã sẵn sàng",
  alreadySetUp: "Không gian làm việc này đã được thiết lập. Hãy đăng nhập.",
  failed: "Thiết lập thất bại",
}
