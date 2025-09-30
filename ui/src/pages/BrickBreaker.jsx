import { useCallback, useEffect, useRef, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import './BrickBreaker.css';

const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 480;

const PADDLE_BASE_WIDTH = 120;
const PADDLE_MIN_WIDTH = 70;
const PADDLE_HEIGHT = 14;
const PADDLE_SPEED = 7.25;

const BALL_RADIUS = 8;
const BALL_BASE_SPEED = 4.2;
const BALL_MAX_SPEED = 12.5;

const BRICK_HEIGHT = 26;

const BRICK_PALETTES = [
  ['#bae6fd', '#38bdf8', '#0ea5e9'],
  ['#fbcfe8', '#f472b6', '#db2777'],
  ['#bfdbfe', '#60a5fa', '#2563eb'],
  ['#bbf7d0', '#4ade80', '#16a34a'],
  ['#fef08a', '#facc15', '#ca8a04'],
  ['#ddd6fe', '#a855f7', '#7c3aed'],
];

function generateBricks(level) {
  const minRows = 3;
  const maxRows = Math.min(5 + Math.floor(level / 2), 8);
  const rowCount =
    Math.floor(Math.random() * (maxRows - minRows + 1)) + minRows;

  const minColumns = 6;
  const maxColumns = Math.min(9 + Math.floor(level / 1.5), 12);
  const columnCount =
    Math.floor(Math.random() * (maxColumns - minColumns + 1)) + minColumns;

  const palette =
    BRICK_PALETTES[Math.floor(Math.random() * BRICK_PALETTES.length)];

  const horizontalPadding = 10;
  const verticalPadding = 10;
  const usableWidth =
    CANVAS_WIDTH - horizontalPadding * (columnCount - 1) - 80;
  const brickWidth = usableWidth / columnCount;
  const offsetX =
    (CANVAS_WIDTH - (brickWidth * columnCount + horizontalPadding * (columnCount - 1))) /
    2;
  const offsetY = 70;

  const bricks = [];
  const strengthCap = Math.min(3, 1 + Math.floor(level / 2));
  const skipChance = Math.min(0.08 + level * 0.02, 0.22);

  for (let row = 0; row < rowCount; row += 1) {
    for (let col = 0; col < columnCount; col += 1) {
      if (Math.random() < skipChance && bricks.length > columnCount / 2) {
        continue;
      }

      const baseStrength =
        1 + Math.floor(Math.random() * Math.max(1, strengthCap));
      const bonus = Math.random() < 0.18 ? 1 : 0;
      const strength = Math.min(3, baseStrength + bonus);

      bricks.push({
        x: offsetX + col * (brickWidth + horizontalPadding),
        y: offsetY + row * (BRICK_HEIGHT + verticalPadding),
        width: brickWidth,
        height: BRICK_HEIGHT,
        strength,
        maxStrength: strength,
        palette,
      });
    }
  }

  if (bricks.length === 0) {
    return generateBricks(level);
  }

  return bricks;
}

export default function BrickBreaker() {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const statusRef = useRef('idle');
  const levelRef = useRef(1);
  const keysRef = useRef({ left: false, right: false });

  const paddleRef = useRef({
    width: PADDLE_BASE_WIDTH,
    height: PADDLE_HEIGHT,
    x: (CANVAS_WIDTH - PADDLE_BASE_WIDTH) / 2,
    y: CANVAS_HEIGHT - 48,
  });

  const ballRef = useRef({
    x: CANVAS_WIDTH / 2,
    y: CANVAS_HEIGHT - 80,
    radius: BALL_RADIUS,
    speed: BALL_BASE_SPEED,
    dx: BALL_BASE_SPEED * (Math.random() < 0.5 ? -0.7 : 0.7),
    dy: -BALL_BASE_SPEED,
  });

  const bricksRef = useRef(generateBricks(1));

  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [level, setLevel] = useState(1);
  const [gameStatus, setGameStatus] = useState('idle');

  statusRef.current = gameStatus;
  levelRef.current = level;

  const prepareLevel = useCallback((levelNumber) => {
    const paddle = paddleRef.current;
    const clampedWidth = Math.max(
      PADDLE_MIN_WIDTH,
      PADDLE_BASE_WIDTH - (levelNumber - 1) * 8
    );
    paddle.width = clampedWidth;
    paddle.height = PADDLE_HEIGHT;
    paddle.x = (CANVAS_WIDTH - clampedWidth) / 2;
    paddle.y = CANVAS_HEIGHT - 48;

    const baseSpeed = BALL_BASE_SPEED + (levelNumber - 1) * 0.35;
    const angle = (Math.random() * Math.PI) / 3 + Math.PI / 6;
    const direction = Math.random() < 0.5 ? -1 : 1;
    const speed = Math.min(baseSpeed, BALL_MAX_SPEED);

    ballRef.current = {
      x: paddle.x + clampedWidth / 2,
      y: paddle.y - BALL_RADIUS - 1,
      radius: BALL_RADIUS,
      speed,
      dx: Math.cos(angle) * speed * direction,
      dy: -Math.abs(Math.sin(angle) * speed),
    };
  }, []);

  const startNewGame = useCallback(() => {
    bricksRef.current = generateBricks(1);
    keysRef.current = { left: false, right: false };
    setScore(0);
    setLives(3);
    setLevel(1);
    prepareLevel(1);
    setGameStatus('ready');
  }, [prepareLevel]);

  const updateHighScoreFromStorage = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const stored = window.localStorage.getItem('brickBreakerHighScore');
      if (!stored) {
        return;
      }

      const parsed = Number.parseInt(stored, 10);
      if (!Number.isNaN(parsed)) {
        setHighScore(parsed);
      }
    } catch {
      // Ignore storage access errors.
    }
  }, []);

  useEffect(() => {
    updateHighScoreFromStorage();
  }, [updateHighScoreFromStorage]);

  useEffect(() => {
    if (score <= highScore) {
      return;
    }

    setHighScore(score);
  }, [highScore, score]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!Number.isFinite(highScore) || highScore <= 0) {
      return;
    }

    try {
      const serialized = String(highScore);
      if (window.localStorage.getItem('brickBreakerHighScore') === serialized) {
        return;
      }

      window.localStorage.setItem('brickBreakerHighScore', serialized);
    } catch {
      // Ignore storage access errors.
    }
  }, [highScore]);

  useEffect(() => {
    prepareLevel(levelRef.current);
  }, [prepareLevel]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.defaultPrevented) {
        return;
      }

      if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') {
        keysRef.current.left = true;
        event.preventDefault();
        return;
      }

      if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') {
        keysRef.current.right = true;
        event.preventDefault();
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        const status = statusRef.current;
        if (status === 'running') {
          setGameStatus('paused');
        } else if (status === 'paused') {
          setGameStatus('running');
        } else if (status === 'ready') {
          setGameStatus('running');
        } else {
          startNewGame();
        }
      }
    };

    const handleKeyUp = (event) => {
      if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') {
        keysRef.current.left = false;
      }

      if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') {
        keysRef.current.right = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [startNewGame]);

  // Mouse control for the paddle
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const handlePointerMove = (event) => {
      if (
        statusRef.current !== 'running' &&
        statusRef.current !== 'ready'
      )
        return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const mouseX = (event.clientX - rect.left) * scaleX;
      const paddle = paddleRef.current;
      const maxPaddleX = CANVAS_WIDTH - paddle.width;
      paddle.x = Math.max(0, Math.min(maxPaddleX, mouseX - paddle.width / 2));
    };

    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('mousemove', handlePointerMove);
    return () => {
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('mousemove', handlePointerMove);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const handleLaunch = () => {
      if (statusRef.current === 'ready') {
        setGameStatus('running');
      }
    };

    canvas.addEventListener('pointerdown', handleLaunch);
    canvas.addEventListener('click', handleLaunch);

    return () => {
      canvas.removeEventListener('pointerdown', handleLaunch);
      canvas.removeEventListener('click', handleLaunch);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const context = canvas.getContext('2d');

    const drawScene = () => {
      const gradient = context.createLinearGradient(
        0,
        0,
        0,
        CANVAS_HEIGHT
      );
      gradient.addColorStop(0, 'rgba(15, 23, 42, 0.95)');
      gradient.addColorStop(1, 'rgba(30, 41, 59, 0.95)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      const bricks = bricksRef.current;
      for (let i = 0; i < bricks.length; i += 1) {
        const brick = bricks[i];
        const paletteIndex = Math.max(
          0,
          Math.min(brick.palette.length - 1, brick.strength - 1)
        );
        context.fillStyle = brick.palette[paletteIndex];
        context.fillRect(brick.x, brick.y, brick.width, brick.height);
        context.strokeStyle = 'rgba(15, 23, 42, 0.85)';
        context.lineWidth = 2;
        context.strokeRect(brick.x, brick.y, brick.width, brick.height);
      }

      const paddle = paddleRef.current;
      context.fillStyle = 'rgba(226, 232, 240, 0.95)';
      context.fillRect(paddle.x, paddle.y, paddle.width, paddle.height);
      context.strokeStyle = 'rgba(148, 163, 184, 0.5)';
      context.lineWidth = 2;
      context.strokeRect(paddle.x, paddle.y, paddle.width, paddle.height);

      const ball = ballRef.current;
      if (statusRef.current === 'ready') {
        ball.x = paddle.x + paddle.width / 2;
        ball.y = paddle.y - ball.radius - 1;
      }
      context.beginPath();
      context.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      context.closePath();
      context.fillStyle = '#f8fafc';
      context.fill();
      context.lineWidth = 2;
      context.strokeStyle = '#38bdf8';
      context.stroke();
    };

    const updateGame = () => {
      const paddle = paddleRef.current;
      const ball = ballRef.current;
      const status = statusRef.current;

      const effectiveSpeed = PADDLE_SPEED + levelRef.current * 0.15;
      if (status === 'running' || status === 'ready') {
        if (keysRef.current.left) {
          paddle.x -= effectiveSpeed;
        }

        if (keysRef.current.right) {
          paddle.x += effectiveSpeed;
        }
      }

      const maxPaddleX = CANVAS_WIDTH - paddle.width;
      paddle.x = Math.max(0, Math.min(maxPaddleX, paddle.x));

      if (status !== 'running') {
        return;
      }

      ball.x += ball.dx;
      ball.y += ball.dy;

      if (ball.x + ball.radius >= CANVAS_WIDTH) {
        ball.x = CANVAS_WIDTH - ball.radius - 1;
        ball.dx = -Math.abs(ball.dx);
      } else if (ball.x - ball.radius <= 0) {
        ball.x = ball.radius + 1;
        ball.dx = Math.abs(ball.dx);
      }

      if (ball.y - ball.radius <= 0) {
        ball.y = ball.radius + 1;
        ball.dy = Math.abs(ball.dy);
      }

      if (
        ball.dy > 0 &&
        ball.y + ball.radius >= paddle.y &&
        ball.y + ball.radius <= paddle.y + paddle.height + 4 &&
        ball.x >= paddle.x &&
        ball.x <= paddle.x + paddle.width
      ) {
        const paddleCenter = paddle.x + paddle.width / 2;
        const distanceFromCenter = ball.x - paddleCenter;
        const normalized = distanceFromCenter / (paddle.width / 2);
        const maxBounceAngle = (75 * Math.PI) / 180;
        const bounceAngle = normalized * maxBounceAngle;
        const newSpeed = Math.min(
          ball.speed + 0.25,
          BALL_MAX_SPEED + levelRef.current * 0.3
        );
        ball.speed = newSpeed;
        ball.dx = Math.sin(bounceAngle) * newSpeed;
        ball.dy = -Math.cos(bounceAngle) * newSpeed;
        ball.y = paddle.y - ball.radius - 1;
      }

      const bricks = bricksRef.current;
      for (let i = 0; i < bricks.length; i += 1) {
        const brick = bricks[i];
        if (
          ball.x + ball.radius < brick.x ||
          ball.x - ball.radius > brick.x + brick.width ||
          ball.y + ball.radius < brick.y ||
          ball.y - ball.radius > brick.y + brick.height
        ) {
          continue;
        }

        const overlapLeft = ball.x + ball.radius - brick.x;
        const overlapRight =
          brick.x + brick.width - (ball.x - ball.radius);
        const overlapTop = ball.y + ball.radius - brick.y;
        const overlapBottom =
          brick.y + brick.height - (ball.y - ball.radius);
        const minOverlap = Math.min(
          overlapLeft,
          overlapRight,
          overlapTop,
          overlapBottom
        );

        if (minOverlap === overlapLeft) {
          ball.x = brick.x - ball.radius - 1;
          ball.dx = -Math.abs(ball.dx);
        } else if (minOverlap === overlapRight) {
          ball.x = brick.x + brick.width + ball.radius + 1;
          ball.dx = Math.abs(ball.dx);
        } else if (minOverlap === overlapTop) {
          ball.y = brick.y - ball.radius - 1;
          ball.dy = -Math.abs(ball.dy);
        } else {
          ball.y = brick.y + brick.height + ball.radius + 1;
          ball.dy = Math.abs(ball.dy);
        }

        const brickStrengthBefore = brick.strength;
        brick.strength -= 1;
        if (brick.strength <= 0) {
          bricks.splice(i, 1);
          i -= 1;
        }

        const points = 50 + brickStrengthBefore * 20 + levelRef.current * 10;
        setScore((prev) => prev + points);

        const boostedSpeed = Math.min(
          ball.speed * 1.02 + levelRef.current * 0.05,
          BALL_MAX_SPEED + levelRef.current * 0.4
        );
        const angleAfter = Math.atan2(ball.dy, ball.dx);
        ball.speed = boostedSpeed;
        ball.dx = Math.cos(angleAfter) * boostedSpeed;
        ball.dy = Math.sin(angleAfter) * boostedSpeed;

        break;
      }

      if (ball.y - ball.radius > CANVAS_HEIGHT) {
        keysRef.current.left = false;
        keysRef.current.right = false;
        setLives((prevLives) => {
          const nextLives = prevLives - 1;
          if (nextLives <= 0) {
            if (statusRef.current !== 'gameover') {
              setGameStatus('gameover');
            }
            prepareLevel(1);
          } else {
            prepareLevel(levelRef.current);
            setGameStatus('ready');
          }
          return Math.max(0, nextLives);
        });
      }

      if (statusRef.current !== 'gameover' && bricks.length === 0) {
        setLevel((prevLevel) => {
          const nextLevel = prevLevel + 1;
          bricksRef.current = generateBricks(nextLevel);
          prepareLevel(nextLevel);
          return nextLevel;
        });
        setGameStatus('ready');
      }
    };

    const frame = () => {
      updateGame();

      drawScene();
      animationRef.current = window.requestAnimationFrame(frame);
    };

    animationRef.current = window.requestAnimationFrame(frame);

    return () => {
      if (animationRef.current) {
        window.cancelAnimationFrame(animationRef.current);
      }
    };
  }, [prepareLevel]);

  const overlayTitle = (() => {
    if (gameStatus === 'idle') {
      return 'Brick Breaker';
    }

    if (gameStatus === 'paused') {
      return 'Paused';
    }

    if (gameStatus === 'gameover') {
      return 'Game Over';
    }

    return '';
  })();

  const overlayDescription = (() => {
    if (gameStatus === 'idle') {
      return 'Press the space bar or the Start button to begin.';
    }

    if (gameStatus === 'paused') {
      return 'Press space or resume to keep smashing bricks.';
    }

    if (gameStatus === 'gameover') {
      return 'All lives lost. Ready for another run?';
    }

    return '';
  })();

  const showOverlay =
    gameStatus === 'idle' || gameStatus === 'paused' || gameStatus === 'gameover';

  const buttonLabel = (() => {
    if (gameStatus === 'paused') {
      return 'Resume';
    }

    if (gameStatus === 'gameover') {
      return 'Play Again';
    }

    return 'Start';
  })();

  const spaceAction =
    gameStatus === 'paused'
      ? 'resume'
      : gameStatus === 'running'
        ? 'pause'
        : 'start';

  const handlePrimaryAction = () => {
    if (gameStatus === 'running') {
      setGameStatus('paused');
    } else if (gameStatus === 'paused') {
      setGameStatus('running');
    } else {
      startNewGame();
    }
  };

  return (
    <>
      <BackButton />
      <div className="brick-breaker-container">
        <header className="brick-breaker-header">
          <h1>Brick Breaker</h1>
          <div className="brick-breaker-scoreboard">
            <span>Score: {score}</span>
            <span>High Score: {highScore}</span>
            <span>Lives: {lives}</span>
            <span>Level: {level}</span>
          </div>
        </header>
        <div className="brick-breaker-stage">
          <canvas
            ref={canvasRef}
            className="brick-breaker-canvas"
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
          />
          {showOverlay && (
            <div className="brick-breaker-overlay" role="status">
              <div className="brick-breaker-overlay-content">
                <h2>{overlayTitle}</h2>
                <p>{overlayDescription}</p>
                {gameStatus === 'gameover' && (
                  <p className="brick-breaker-overlay-score">
                    Final score: {score}
                  </p>
                )}
                <p className="brick-breaker-overlay-hint">
                  Move the mouse to control the paddle.
                </p>
                <button
                  type="button"
                  className="brick-breaker-overlay-button"
                  onClick={handlePrimaryAction}
                >
                  {buttonLabel}
                </button>
                <p className="brick-breaker-overlay-hint">
                  Use ← → or A / D to move the paddle.
                </p>
                <p className="brick-breaker-overlay-hint">
                  Press space to {spaceAction}.
                </p>
              </div>
            </div>
          )}
        </div>
        <footer className="brick-breaker-footer">
          <p>
            Tip: Clearing every brick progresses you to the next level with a
            fresh, procedurally generated wall.
          </p>
        </footer>
      </div>
    </>
  );
}
