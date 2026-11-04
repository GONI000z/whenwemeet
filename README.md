# 우리 언제 만나

친구들끼리 모임별 달력에서 되는 날을 체크하고, 기타 일정을 공유하는 앱이에요.
안드로이드는 APK로 설치하고, 아이폰은 웹 버전을 "홈 화면에 추가"해서 써요. 둘은 같은 데이터를 봐요.

## 처음 한 번만 하는 설정

1. **Firestore 보안 규칙**: Firebase 콘솔 → Firestore → "규칙" 탭에 `firestore.rules` 내용을 통째로 붙여넣고 "게시".
2. **GitHub Pages 켜기**: 이 저장소의 Settings → Pages → Source를 **GitHub Actions**로.
3. 파일을 올리거나 고치면 Actions 탭에서 "앱 만들기"가 자동으로 돌아가요(약 5~10분).

## 결과물 받기

- **안드로이드 APK**: 저장소 오른쪽의 Releases → "우리 언제 만나 (최신)" → `uri-eonje-mannal.apk`
- **아이폰·웹**: `https://<내 GitHub 아이디>.github.io/<저장소 이름>/` 를 Safari로 열고 공유 → "홈 화면에 추가"

## 알아 둘 점

- 회원가입 없이 기기마다 익명 계정이 자동으로 만들어져요. 앱을 지우거나 앱 데이터를 삭제하면 새 사람으로 인식돼서, 예전에 넣은 일정을 고칠 수 없게 돼요. 모임은 초대 코드로 다시 들어가면 돼요.
- APK는 항상 같은 서명 키(`keystore/debug.keystore`)로 만들어져서, 새 버전을 받으면 지우지 않고 덮어 설치할 수 있어요.

## 파일 구성

- `src/app.js` 화면과 동작, `src/index.html` 디자인, `src/firebase-config.js` Firebase 연결값
- `build.mjs` 웹 파일(www/) 만들기, `capacitor.config.json` 안드로이드 앱 설정
- `.github/workflows/build.yml` APK와 웹 버전 자동 빌드
- `assets/` 앱 아이콘·시작 화면, `public/` 웹 아이콘
