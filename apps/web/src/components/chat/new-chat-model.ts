export interface SessionCreatedHandlers {
  readonly closeDialog: () => void;
  readonly refreshSessionList: () => void;
  readonly navigateToSession: (sessionId: string) => void;
}

// Choosing a workflow is the one exit from the new-chat dialog that is not
// user-driven, so nothing else clears the parent's `open` state. The sidebar's
// copy of the dialog is rendered by the (user) layout and outlives the
// navigation, so without this close it is left sitting on top of the chat it
// just opened. Closing precedes the navigation for the same reason.
export function handleSessionCreated(
  sessionId: string,
  handlers: SessionCreatedHandlers,
): void {
  handlers.closeDialog();
  handlers.refreshSessionList();
  handlers.navigateToSession(sessionId);
}
