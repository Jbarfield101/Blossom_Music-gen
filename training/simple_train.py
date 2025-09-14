import argparse
import time
import sys


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--lr", type=float, default=0.001)
    args = parser.parse_args()

    for epoch in range(1, args.epochs + 1):
        # Simulate some work
        time.sleep(0.5)
        percent = int(epoch * 100 / args.epochs)
        print(f"train: {percent}% epoch {epoch}/{args.epochs}")
        sys.stdout.flush()

    print("train: 100% done")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
