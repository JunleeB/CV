"""
순수 GPU 추론 시간 측정 (전처리/후처리 제외).

주의: ultralytics의 predict()로 시간을 재면 CPU 전처리·NMS·마스크 디코딩이
섞여서 배치를 키울수록 CPU 오버헤드가 지배적이 되어 GPU 자체의 정밀도/배치
효과가 가려진다. 그래서 polygraphy로 엔진만 직접 두드린다 - 이게 "왜 이
설정에서 GPU가 더 빠른가"를 정확히 답하려는 목적에 맞는 측정 방식이다.

Usage: python benchmark.py --engine model.engine --batch 1 [--iterations 200]
"""
import argparse
import subprocess


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", required=True)
    ap.add_argument("--batch", type=int, default=1)
    ap.add_argument("--iterations", type=int, default=200)
    ap.add_argument("--warmup", type=int, default=20)
    args = ap.parse_args()

    shape = f"images:[{args.batch},3,640,640]"
    cmd = [
        "polygraphy", "run", args.engine, "--trt",
        "--input-shapes", shape,
        "--iterations", str(args.iterations),
        "--warm-up", str(args.warmup),
        "--sequential-runners",  # --warm-up 사용 시 필수
    ]
    subprocess.run(cmd, check=True)
    print(f"\n(참고) per-image latency = 위 'Average inference time' / {args.batch}")


if __name__ == "__main__":
    main()
