export function isMobilePointer(): boolean {
  if (typeof navigator === "undefined") return false;
  const hasTouch = navigator.maxTouchPoints > 0;
  const coarsePointer = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
  const mobileUA = /Mobi|Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent);
  return (hasTouch || coarsePointer) && mobileUA;
}
