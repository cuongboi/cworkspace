import type { DeepStrings } from "../ja/types"
import type { auth as en } from "../en/auth"

export const auth: DeepStrings<typeof en> = {
  fields: {
    name: "Tên",
    email: "Email",
    password: "Mật khẩu",
    newPassword: "Mật khẩu mới",
    confirmPassword: "Xác nhận mật khẩu",
  },
  validation: {
    email: "Nhập email hợp lệ",
    name: "Nhập tên của bạn",
    password: "Nhập mật khẩu",
    passwordLength: "Dùng ít nhất 8 ký tự",
    passwordMismatch: "Mật khẩu không khớp",
  },
  signIn: {
    title: "Đăng nhập",
    description: "Nhập email và mật khẩu của bạn.",
    forgot: "Quên mật khẩu?",
    submit: "Đăng nhập",
    pending: "Đang đăng nhập…",
    failed: "Không thể đăng nhập",
    noAccount: "Chưa có tài khoản?",
    signUp: "Đăng ký",
  },
  signUp: {
    title: "Tạo tài khoản",
    description: "Điền thông tin để bắt đầu.",
    submit: "Đăng ký",
    pending: "Đang tạo tài khoản…",
    failed: "Không thể đăng ký",
    haveAccount: "Đã có tài khoản?",
    signIn: "Đăng nhập",
  },
  forgot: {
    title: "Quên mật khẩu",
    description:
      "Nhập email, chúng tôi sẽ gửi cho bạn liên kết đặt lại mật khẩu.",
    sent: "Nếu email này có tài khoản, liên kết đặt lại mật khẩu đang được gửi đến.",
    submit: "Gửi liên kết đặt lại",
    pending: "Đang gửi…",
    failed: "Không thể gửi liên kết đặt lại",
    backToSignIn: "Quay lại đăng nhập",
  },
  reset: {
    title: "Đặt lại mật khẩu",
    description: "Chọn mật khẩu mới cho tài khoản của bạn.",
    submit: "Đặt lại mật khẩu",
    failed: "Không thể đặt lại mật khẩu",
    invalidTitle: "Liên kết không hợp lệ",
    invalidDescription:
      "Liên kết đặt lại này không hợp lệ hoặc đã hết hạn. Hãy yêu cầu liên kết mới.",
    requestNew: "Yêu cầu liên kết mới",
  },
  invite: {
    title: "Lời mời",
    notFound: "Lời mời này không tồn tại.",
    used: "Lời mời này đã được sử dụng. Đăng nhập để tiếp tục.",
    invalid: "Lời mời này không còn hiệu lực. Bạn vẫn có thể tạo tài khoản.",
    signIn: "Đăng nhập",
    createAccount: "Tạo tài khoản",
    youreIn: "Bạn đã tham gia {{company}}",
    signedInAs: "Đã đăng nhập với {{email}}",
    goToFeed: "Đến Bảng tin",
    join: "Tham gia {{company}}",
    invited: "{{inviter}} đã mời {{email}}",
    createYourAccount: "Tạo tài khoản của bạn",
    haveAccount: "Tôi đã có tài khoản",
  },
}
