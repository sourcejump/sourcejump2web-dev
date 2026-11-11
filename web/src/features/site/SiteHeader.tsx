import { Suspense } from "react";
import { Play } from "next/font/google";
import { Plus } from "lucide-react";
import { Link } from "@/ui/Link";
import { AccountArea } from "./AccountArea";
import { HeaderSearch } from "./HeaderSearch";
import { HeaderShell } from "./HeaderShell";
import { SiteNav, SiteNavLinks } from "./SiteNav";
import styles from "./SiteHeader.module.css";

const wordmark = Play({ weight: "700", subsets: ["latin"] });

export function SiteHeader() {
  return (
    <HeaderShell>
      <div className={styles.shell}>
        <Link
          href="/"
          className={`${wordmark.className} ${styles.wordmark}`}
          aria-label="SourceJump"
        >
          SOURCE<span>JUMP</span>
        </Link>
        <Suspense fallback={<SiteNavLinks pathname={null} />}>
          <SiteNav />
        </Suspense>
        <div className={styles.right}>
          <div className={styles.search}>
            <Suspense fallback={<div className="size-9 xl:w-60" />}>
              <HeaderSearch />
            </Suspense>
          </div>
          <div className={styles.account}>
            <Suspense>
              <AccountArea />
            </Suspense>
          </div>
        </div>
        <details data-site-menu className={styles.mobileMenu}>
          <summary aria-label="Open navigation">
            Menu <Plus aria-hidden />
          </summary>
          <Suspense fallback={<SiteNavLinks pathname={null} mobile />}>
            <SiteNav mobile />
          </Suspense>
        </details>
      </div>
    </HeaderShell>
  );
}
