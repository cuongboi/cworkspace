import type { DeepStrings } from "../ja/types"
import type { errors as en } from "../en/errors"

export const errors: DeepStrings<typeof en> = {
  UNAUTHORIZED: "Vui lòng đăng nhập lại.",
  FORBIDDEN: "Bạn không có quyền thực hiện thao tác này.",
  PASSWORD_CHANGE_REQUIRED: "Vui lòng đổi mật khẩu để tiếp tục.",
  INVALID_INPUT: "Vui lòng kiểm tra lại thông tin đã nhập.",
  NOT_FOUND: "Nội dung này không còn tồn tại.",
  CONFLICT: "Nội dung này đã tồn tại.",
  INVALID_STATE: "Không thể thực hiện thao tác này lúc này.",
  UPSTREAM_ERROR: "Dịch vụ liên kết không phản hồi. Hãy thử lại sau.",
  INTERNAL: "Đã xảy ra lỗi. Hãy thử lại.",
  NETWORK: "Không thể kết nối máy chủ. Hãy kiểm tra kết nối mạng.",
}
