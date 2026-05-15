import { RESULT_CARD_FRAME_URL } from './assets';

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1920;
const PORTRAIT_AREA = {
  height: 1040,
  width: 760,
  x: 160,
  y: 390
};

function loadImage(sourceUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load image: ${sourceUrl}`));
    image.src = sourceUrl;
  });
}

async function loadOptionalFrameImage() {
  try {
    return await loadImage(RESULT_CARD_FRAME_URL);
  } catch (error) {
    console.error(
      '[reaction-card] result_card_frame.png unavailable; using fallback layout.',
      error
    );
    return null;
  }
}

function drawCoverImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const imageRatio = image.width / image.height;
  const targetRatio = width / height;
  const sourceWidth = imageRatio > targetRatio ? image.height * targetRatio : image.width;
  const sourceHeight = imageRatio > targetRatio ? image.height : image.width / targetRatio;
  const sourceX = (image.width - sourceWidth) / 2;
  const sourceY = (image.height - sourceHeight) / 2;

  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function drawCenteredText(
  context: CanvasRenderingContext2D,
  text: string,
  y: number,
  font: string,
  color = '#f6eee8'
) {
  context.save();
  context.fillStyle = color;
  context.font = font;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.shadowColor = 'rgba(215, 25, 32, 0.68)';
  context.shadowBlur = 18;
  context.fillText(text, CARD_WIDTH / 2, y);
  context.restore();
}

function drawFallbackBackground(context: CanvasRenderingContext2D) {
  const gradient = context.createLinearGradient(0, 0, 0, CARD_HEIGHT);
  gradient.addColorStop(0, '#1a0508');
  gradient.addColorStop(0.45, '#060203');
  gradient.addColorStop(1, '#000000');
  context.fillStyle = gradient;
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  context.strokeStyle = 'rgba(215, 25, 32, 0.35)';
  context.lineWidth = 3;
  context.strokeRect(48, 48, CARD_WIDTH - 96, CARD_HEIGHT - 96);
}

function drawResultCardContent(
  context: CanvasRenderingContext2D,
  capturedReactionImage: HTMLImageElement,
  frameImage: HTMLImageElement | null
) {
  context.fillStyle = '#060203';
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  if (frameImage) {
    context.drawImage(frameImage, 0, 0, CARD_WIDTH, CARD_HEIGHT);
  } else {
    drawFallbackBackground(context);
  }

  drawCoverImage(
    context,
    capturedReactionImage,
    PORTRAIT_AREA.x,
    PORTRAIT_AREA.y,
    PORTRAIT_AREA.width,
    PORTRAIT_AREA.height
  );

  drawCenteredText(
    context,
    '붉은 가면의 손님 등록 완료',
    frameImage ? 214 : 280,
    '700 58px Inter, system-ui, sans-serif'
  );
  drawCenteredText(
    context,
    '방금, 무도회에 초대되었습니다.',
    frameImage ? 1614 : 1680,
    '700 46px Inter, system-ui, sans-serif'
  );
  drawCenteredText(
    context,
    '#붉은가면챌린지 #고스트파크리액션',
    frameImage ? 1692 : 1760,
    '600 34px Inter, system-ui, sans-serif',
    '#d9cfca'
  );
}

export async function generateReactionResultCardDataUrl(capturedReactionImageUrl: string) {
  const [capturedReactionImage, frameImage] = await Promise.all([
    loadImage(capturedReactionImageUrl),
    loadOptionalFrameImage()
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;

  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Canvas is not supported in this browser.');
  }

  drawResultCardContent(context, capturedReactionImage, frameImage);

  return canvas.toDataURL('image/png');
}
