// The browser's own "Please fill out this field" bubbles follow the phone's language, not the
// page's. This replaces them with short messages in the language the page is shown in.
type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const isField = (t: EventTarget | null): t is Field =>
  t instanceof HTMLInputElement ||
  t instanceof HTMLTextAreaElement ||
  t instanceof HTMLSelectElement;

export function fieldMessage(field: Field, ar: boolean): string {
  const v = field.validity;
  if (v.valueMissing)
    return field instanceof HTMLInputElement && field.type === 'checkbox'
      ? ar
        ? 'لازم توافق على ده عشان تكمل.'
        : 'Tick this box to continue.'
      : ar
        ? 'الخانة دي مطلوبة.'
        : 'This field is required.';
  if (v.typeMismatch && field.type === 'email')
    return ar ? 'اكتب إيميل صحيح، زي name@gmail.com' : 'Enter a valid email, like name@gmail.com';
  if (v.tooShort && 'minLength' in field)
    return ar
      ? `محتاج ${field.minLength} حروف على الأقل.`
      : `Use at least ${field.minLength} characters.`;
  if (v.rangeUnderflow && 'min' in field)
    return ar ? `أقل رقم مسموح ${field.min}.` : `The smallest allowed number is ${field.min}.`;
  if (v.rangeOverflow && 'max' in field)
    return ar ? `أكبر رقم مسموح ${field.max}.` : `The largest allowed number is ${field.max}.`;
  if (v.patternMismatch || v.badInput)
    return ar ? 'الصيغة مش مظبوطة، راجعها.' : 'Check the format and try again.';
  return '';
}

/** The box people see for a field: the wrapper for fields drawn inside one (password, color). */
const boxOf = (field: Element) =>
  field.closest<HTMLElement>('.password-control') || (field as HTMLElement);

/**
 * Marks a field that needs fixing: a red box that shakes once, and the reason written right
 * under it, so the problem is found where it is instead of after the whole form.
 */
export function markInvalid(field: Element, message: string) {
  const box = boxOf(field);
  box.classList.add('field-invalid');
  // Restart the shake when the same field is rejected again.
  box.classList.remove('field-shake');
  void box.offsetWidth;
  box.classList.add('field-shake');
  const label = field.closest('label');
  if (label && message) label.dataset.error = message;
}
export function clearInvalid(field: Element) {
  boxOf(field).classList.remove('field-invalid', 'field-shake');
  const label = field.closest('label');
  if (label) delete label.dataset.error;
}

export function installFormMessages(doc: Document = document) {
  // Only messages set here are replaced; a screen's own custom message is left alone.
  const ours = new WeakSet<Field>();
  doc.addEventListener(
    'invalid',
    (event) => {
      if (!isField(event.target)) return;
      const field = event.target;
      if (field.validity.customError && !ours.has(field)) return;
      field.setCustomValidity('');
      ours.delete(field);
      if (field.validity.valid) return;
      const message = fieldMessage(
        field,
        doc.documentElement.lang === 'ar' || doc.documentElement.dir === 'rtl',
      );
      if (message) {
        field.setCustomValidity(message);
        ours.add(field);
      }
      markInvalid(field, field.validationMessage);
    },
    true,
  );
  // Clear the custom message as soon as the person edits, so the field can become valid.
  const reset = (event: Event) => {
    if (!isField(event.target)) return;
    if (ours.has(event.target)) {
      event.target.setCustomValidity('');
      ours.delete(event.target);
    }
    const field = event.target;
    if (field.validity.valid) clearInvalid(field);
    else if (field.closest('label')?.dataset.error) {
      // Still wrong while typing: keep the reason current (e.g. from "required" to "too short").
      const message = fieldMessage(field, doc.documentElement.lang === 'ar');
      if (message) field.closest('label')!.dataset.error = message;
    }
  };
  doc.addEventListener('input', reset, true);
  doc.addEventListener('change', reset, true);
}
