"use client";

import { useEffect, useRef, useState } from "react";

type CameraStatus = "requesting" | "ready" | "error";

type CameraErrorKind = "permission" | "not-found" | "unsupported" | "unknown";

function classifyError(error: unknown): CameraErrorKind {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "permission";
    }
    if (
      error.name === "NotFoundError" ||
      error.name === "DevicesNotFoundError" ||
      error.name === "OverconstrainedError"
    ) {
      return "not-found";
    }
  }
  return "unknown";
}

/**
 * Webcam preview cục bộ của Studio (spec §5.5).
 *
 * - Chỉ xin quyền khi component được mount (Studio chỉ mount khi đang LIVE) và
 *   luôn stop toàn bộ track khi unmount — không để đèn camera sáng sau khi
 *   xuống sóng.
 * - Mọi lỗi quyền/thiết bị đều biến thành khối hướng dẫn tiếng Việt; lỗi
 *   camera KHÔNG chặn phần còn lại của Studio.
 * - Đây chỉ là preview phía seller — chưa phải luồng phát cho khách (Plan 1
 *   không truyền video qua socket).
 */
export default function WebcamPreview() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<CameraStatus>("requesting");
  const [errorKind, setErrorKind] = useState<CameraErrorKind>("unknown");

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) {
          setErrorKind("unsupported");
          setStatus("error");
        }
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (cancelled) {
          // Effect đã cleanup (StrictMode/unmount) trước khi camera kịp mở.
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const video = videoRef.current;
        if (video !== null) {
          video.srcObject = stream;
          // autoPlay thường đủ; gọi play() để chắc chắn với video không có audio.
          void video.play().catch(() => {
            // Trình duyệt có thể chặn autoplay cho tới khi có tương tác — video
            // vẫn hiện frame đầu tiên, không cần báo lỗi.
          });
        }
        setStatus("ready");
      } catch (error) {
        if (cancelled) return;
        setErrorKind(classifyError(error));
        setStatus("error");
      }
    }

    void startCamera();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#101014]">
      <video
        ref={videoRef}
        muted
        autoPlay
        playsInline
        className={`h-full w-full -scale-x-100 object-cover transition-opacity duration-300 ${
          status === "ready" ? "opacity-100" : "opacity-0"
        }`}
      />

      {status !== "ready" && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-md text-center text-zinc-400">
            {status === "requesting" ? (
              <>
                <p className="text-4xl" aria-hidden>
                  📷
                </p>
                <p className="mt-3 text-sm font-medium text-zinc-300">
                  Đang bật camera…
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Trình duyệt sẽ hỏi quyền truy cập camera.
                </p>
              </>
            ) : (
              <>
                <p className="text-4xl" aria-hidden>
                  {errorKind === "permission" ? "🔒" : "📷"}
                </p>
                <p className="mt-3 text-sm font-semibold text-zinc-200">
                  Không bật được webcam
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
                  {errorKind === "permission"
                    ? "Trình duyệt đang chặn quyền camera. Bấm biểu tượng camera/ổ khoá trên thanh địa chỉ, cấp quyền rồi tải lại trang."
                    : errorKind === "not-found"
                      ? "Không tìm thấy camera trên máy này. Bạn vẫn có thể tiếp tục live — khung này chỉ là preview phía seller."
                      : errorKind === "unsupported"
                        ? "Trình duyệt không hỗ trợ camera hoặc trang không chạy trong ngữ cảnh bảo mật (HTTPS/localhost). Studio vẫn hoạt động bình thường."
                        : "Không mở được camera. Kiểm tra thiết bị và quyền truy cập rồi tải lại trang — phần còn lại của Studio vẫn dùng được."}
                </p>
                <p className="mt-2 text-[11px] text-zinc-500">
                  Preview chỉ hiển thị trong Studio của bạn, không phải luồng phát
                  cho khách.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
