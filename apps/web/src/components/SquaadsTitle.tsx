"use client";

import SensitiveText from "@/components/ui/sensitive-text";

export function SquaadsTitle() {
  return (
    <SensitiveText
      variant="compress"
      maxStretch={0.8}
      sensitivity={0.6}
      easing={12}
      hoverColor="#00F2FF"
      className="text-xl font-bold tracking-tight"
    >
      Squaads Bot
    </SensitiveText>
  );
}
