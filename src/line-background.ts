import { Decoration, EditorView } from '@codemirror/view';
import { marksField } from './mark-extension';
import { colorClass } from './color';

// Colors the background of marked lines with the color of each mark.
// Marks with no color are not colored, so that marks can be told apart by whether they stand out.
// Lines replaced by a widget (e.g. tables and callouts in Live Preview) are not colored, because line decorations are not visible there.
export const lineBackground = EditorView.decorations.compute([marksField], state => Decoration.set(
	state.field(marksField)
		.filter(mark => mark.color)
		.map(mark => Decoration.line({ class: `line-marks-line ${colorClass(mark.color)}` }).range(mark.from)),
	true,
));
