// The staff area: its sections beside each page. Kept out of search engines.
import type { Metadata } from "next";
import { StaffSidebar } from "@/features/staff/StaffSidebar";

export const metadata: Metadata = {
  title: { default: "Staff", template: "%s · Staff · SourceJump" },
  robots: { index: false, follow: false },
};

export default function StaffLayout({ children }: LayoutProps<"/staff">) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-10 lg:flex-row lg:gap-10">
      <StaffSidebar />
      {children}
    </div>
  );
}
