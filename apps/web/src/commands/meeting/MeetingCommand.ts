export interface MeetingCommand<T> {
  execute(): Promise<T>;
}

