# REACT++ (Scene Graph Generation) 비교 실험

공개 오픈소스 프로젝트 [SGG-Benchmark](https://github.com/Maelic/SGG-Benchmark)의 REACT++ 모델을
우리 데이터로 파인튜닝해, 규칙기반 위치판정 접근과 학습 기반 Scene Graph Generation 접근의
트레이드오프를 비교한 실험입니다. 자세한 배경과 결과 해석은
[상위 README](../README.md#4단계--reactscene-graph-generation와의-비교-실험-react_pp_comparison)를 참고하세요.

## 구조

- `convert_homeai.py` — VLM이 생성한 위치 GT(`gt_locations/*.jsonl`)를 SGG용 관계 트리플릿
  (subject, predicate, object) 형식의 COCO 포맷으로 변환
- `react_pp_ft_config.yml` — REACT++ 백본을 우리 YOLO11m 탐지기로 교체하고, 물체 12클래스·관계
  4클래스로 파인튜닝한 실제 학습 설정 (SGG-Benchmark 프레임워크 표준 config 포맷)

## 실행 전 참고

`convert_homeai.py`, `react_pp_ft_config.yml` 모두 [SGG-Benchmark](https://github.com/Maelic/SGG-Benchmark)
프레임워크가 별도로 설치돼있어야 동작합니다. 여기서는 우리 도메인에 맞게 작성한 데이터 변환 스크립트와
학습 설정만 발췌해서 남겼습니다.
