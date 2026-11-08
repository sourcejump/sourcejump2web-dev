// A middle dot between the items of a line that can wrap. Hidden on phones, where such lines wrap and a dot would be
// left alone at a line's end; the line's flex gap spaces the items there instead, so give it a little more there.
export function Dot() {
  return (
    <span aria-hidden className="text-text-subtle max-sm:hidden">
      ·
    </span>
  );
}
