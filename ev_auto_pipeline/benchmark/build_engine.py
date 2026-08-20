"""
polygraphy 기반 TensorRT 엔진 빌드 래퍼.
trtexec는 pip 배포판에 포함되지 않아 polygraphy로 대체했다.

Usage:
  python build_engine.py --onnx model.onnx --precision fp16 --batch 1 \
      --out model_fp16.engine
  python build_engine.py --onnx model.onnx --precision int8 --batch 1 \
      --calib-cache calib.cache --out model_int8.engine
"""
import argparse
import os
import subprocess


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--onnx", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--precision", choices=["fp32", "fp16", "int8"], default="fp16")
    ap.add_argument("--batch", type=int, default=1,
                     help="고정 batch profile (min=opt=max). "
                          "주의: ONNX가 dynamic batch로 export돼 있어야 함")
    ap.add_argument("--calib-cache", default=None,
                     help="INT8 캘리브레이션 캐시 경로. "
                          "다른 배치 크기로 재사용 시 그래프 최적화 경로가 달라져 "
                          "'Could not find any implementation' 에러가 날 수 있음 - "
                          "배치 크기별로 새로 캘리브레이션할 것")
    ap.add_argument("--calib-img-dir", default=None,
                     help="INT8일 때 필요. 실제 배포 도메인 이미지 폴더")
    args = ap.parse_args()

    shape = f"images:[{args.batch},3,640,640]"
    cmd = [
        "polygraphy", "run", args.onnx, "--trt",
        "--save-engine", args.out,
        "--trt-min-shapes", shape,
        "--trt-opt-shapes", shape,
        "--trt-max-shapes", shape,
    ]
    if args.precision == "fp16":
        cmd.append("--fp16")
    elif args.precision == "int8":
        cmd.append("--int8")
        loader = os.path.join(os.path.dirname(__file__), "calibration_loader.py")
        cmd += ["--data-loader-script", loader]
        if args.calib_cache:
            cmd += ["--calibration-cache", args.calib_cache]
        env = os.environ.copy()
        if args.calib_img_dir:
            env["CALIB_IMG_DIR"] = args.calib_img_dir
        env["CALIB_BATCH"] = str(args.batch)
        subprocess.run(cmd, check=True, env=env)
        return

    subprocess.run(cmd, check=True)


if __name__ == "__main__":
    main()
