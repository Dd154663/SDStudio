import { ImageService } from './models/ImageService';
import { ImageDownloadService } from './models/ImageDownloadService';
import { LoginService } from './models/LoginService';
import { PromptService } from './models/PromptService';
import { SessionService } from './models/SessionService';
import { TaskQueueService } from './models/TaskQueueService';
import { Session } from './models/types';

declare module '*.png';

declare module '*.scss';

declare global {
  interface Window {
    curSession?: Session;
    promptService: PromptService;
    sessionService: SessionService;
    imageService: ImageService;
    imageDownloadService: ImageDownloadService;
    taskQueueService: TaskQueueService;
    loginService: LoginService;
  }
}
