# 안녕하세요, **배준이**입니다.

컴퓨터 비전 파이프라인을 기획부터 서비스화까지 직접 구현하는 AI 엔지니어입니다. 
YOLO11 + SAM2 기반 자동 어노테이션 시스템을 여러 CCTV 도메인(엘리베이터, 화재·연기, 실내 객체 위치 추론)에 적용하며, 데이터 수집·모델 학습·백엔드/프론트엔드 개발까지 엔드투엔드로 수행한 경험이 있습니다.

<p align="center">
  <img src="https://img.shields.io/badge/Python-3776AB?style=flat&logo=python&logoColor=white" alt="Python" />
  <img src="https://img.shields.io/badge/PyTorch-EE4C2C?style=flat&logo=pytorch&logoColor=white" alt="PyTorch" />
  <img src="https://img.shields.io/badge/FastAPI-009688?style=flat&logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/React-61DAFB?style=flat&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/정보처리기사-228B22?style=flat" alt="정보처리기사" />
  <img src="https://img.shields.io/badge/SQLD-336791?style=flat" alt="SQLD" />
</p>

---

## 🚀 핵심 역량 & 스택

| 분야 | 주요 기술 / 도구 | 활용 수준 |
|---|---|---|
| **객체 탐지 / 세그멘테이션** | YOLO11, SAM2 (Meta), Grounding DINO (제로샷) | ★★★★★ |
| **VLM 파이프라인 설계** | Qwen3-VL 기반 역할 분리 파이프라인, 프롬프트/추론 최적화 | ★★★★☆ |
| **ML 인프라 / 학습** | PyTorch, Ultralytics, SLURM GPU 클러스터, 멀티 GPU 추론 서버 구성 | ★★★★☆ |
| **소프트웨어 자격 & 이론** | 정보처리기사, SQLD | ★★★☆☆ |

---

## ✨ 대표 프로젝트

실제 CCTV 환경에 자동 어노테이션 파이프라인을 적용하며 겪은 문제와 해결 과정입니다. 계약 조건상 발주처명은 업종만 표기합니다.

| 프로젝트 | 한 줄 요약 | 담당 역할 | 링크 |
|---|---|---|---|
| **CCTV 자동 어노테이션 시스템** (엘리베이터 제조사向) | YOLO11+SAM2 기반 수동 라벨링 자동화, 거울 반사 오탐을 ROI 지정 방식으로 해결 | 단독 개발 (기획·ML·Backend·Frontend) | [바로가기](docs/project_a_elevator.md) |
| **CCTV 화재·연기 자동 어노테이션** (타이어 제조사向) | 학습/실환경 bbox 크기 불일치로 인한 도메인 갭 규명 → SAM2 Video Tracking 전환으로 소형 객체 탐지 해결 | 단독 개발 | [바로가기](docs/project_b_firesmoke.md) |
| **CCTV 객체 위치 추론 파이프라인** (시니어 레지던스 AI 편의 서비스) | VLM 역할 분리 설계로 42,083건 위치분류 unknown 0건 달성 | GT 파이프라인 설계 및 VLM 통합 개발 | [바로가기](docs/project_c_vlm.md) |
| **추론 최적화 & 검증셋 무결성** (엘리베이터 프로젝트 심화) | TensorRT 변환으로 추론 3.78배 가속, 그 과정에서 검증셋 데이터 누수를 발견해 실제 성능을 재검증 (mAP50-95(B) 0.94→0.84) | 단독 수행 | [바로가기](ev_auto_pipeline/README.md#추론-최적화--검증셋-무결성) |

### 사이드 프로젝트

| 프로젝트 | 한 줄 요약 | 역할 |
|---|---|---|
| YOLO 낙상 감지 POC | 카메라 실시간 낙상 이벤트 자동 감지 | 개인 개발 |
| 룸메이트 매칭 시스템 | 생활습관 설문 데이터 기반 궁합 예측 및 추천 | 데이터 전처리 및 추천 알고리즘 개발 |

---


---

## 💬 연락 및 소통 채널

- 이메일: junlee5985@naver.com
- GitHub 프로필: [github.com/JunleeB](https://github.com/JunleeB)

---

✨ 이 포트폴리오는 계속 성장합니다. 새로운 프로젝트, 학습 내용, 개선 사항이 생기면 곧바로 업데이트할 거예요. 자주 들러주세요! 😊
