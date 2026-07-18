// wasm 은 asset/resource(URL 문자열)로 번들된다 — webpack.config.base.ts 룰 참조.
// import 문이 없는 순수 앰비언트 파일이어야 전역 와일드카드 선언이 적용된다.
declare module '*.wasm' {
  const url: string;
  export default url;
}
