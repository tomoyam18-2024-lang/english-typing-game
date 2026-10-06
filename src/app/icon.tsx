import { ImageResponse } from "next/og";

export const size = {
  width: 64,
  height: 64,
};
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#18231f",
          color: "#f0a202",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 26,
          fontWeight: 900,
        }}
      >
        ET
      </div>
    ),
    size,
  );
}
