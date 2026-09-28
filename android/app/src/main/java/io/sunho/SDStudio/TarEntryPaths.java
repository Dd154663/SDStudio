package io.sunho.SDStudio;

import java.io.File;
import java.io.IOException;

// 압축 해제 엔트리 경로 검사(드라이브 동기화 ② B8, 2026-09-28).
// 외부(드라이브 등)에서 받은 아카이브의 엔트리 이름이 대상 폴더 밖을 가리키면
// (../, 절대 경로, 드라이브 문자) 그 엔트리는 풀지 않는다. Android 의존성이 없는
// 순수 Java 라 단독 컴파일·검증이 가능하다.
final class TarEntryPaths {
  private TarEntryPaths() {}

  // canonicalRoot 아래의 안전한 대상 파일을 돌려준다. 밖으로 나가면 null.
  // canonicalRoot 는 호출부가 getCanonicalFile() 로 한 번 정규화해 넘긴다.
  static File resolveInside(File canonicalRoot, String entryName) throws IOException {
    if (entryName == null) return null;
    String n = entryName.replace('\\', '/');
    if (n.isEmpty()) return null;
    // 절대 경로(/…, //server/…) 와 드라이브 문자(C:…) 거부
    if (n.startsWith("/")) return null;
    if (n.length() >= 2 && n.charAt(1) == ':' && Character.isLetter(n.charAt(0))) return null;
    // '..' 구성요소 거부(정규화 전 단계에서 명시적으로)
    for (String part : n.split("/")) {
      if (part.equals("..")) return null;
    }
    File dest = new File(canonicalRoot, n).getCanonicalFile();
    // 최종 방어: 정규화 결과가 루트 자신이거나 루트 아래여야 한다(심볼릭 링크 우회 포함)
    String root = canonicalRoot.getPath();
    String d = dest.getPath();
    if (d.equals(root)) return dest;
    String prefix = root.endsWith(File.separator) ? root : root + File.separator;
    if (!d.startsWith(prefix)) return null;
    return dest;
  }
}
