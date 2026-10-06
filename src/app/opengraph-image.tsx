import { ImageResponse } from "next/og";

export const alt = "English Typing - Type. Learn. Score.";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "linear-gradient(135deg, #f8faf7 0%, #e8efe7 54%, #d7e0d5 100%)",
          color: "#18231f",
          padding: 72,
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            width: "100%",
            height: "100%",
            border: "4px solid #18231f",
            background: "rgba(255, 255, 255, 0.78)",
            boxShadow: "18px 18px 0 #f0a202",
            padding: 64,
          }}
        >
          <div
            style={{
              color: "#40706a",
              fontSize: 30,
              fontWeight: 900,
              letterSpacing: 4,
              textTransform: "uppercase",
            }}
          >
            English Vocabulary Typing
          </div>
          <div
            style={{
              marginTop: 28,
              fontSize: 104,
              fontWeight: 900,
              lineHeight: 0.95,
            }}
          >
            English Typing
          </div>
          <div
            style={{
              marginTop: 28,
              color: "#d94c3f",
              fontSize: 46,
              fontWeight: 900,
            }}
          >
            Type. Learn. Score.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
