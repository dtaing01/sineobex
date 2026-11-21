import 'dart:async';

import 'package:flutter/material.dart';

import '../../security/secure_copy.dart';
import '../tokens.dart';

/// The only items a private box's selection menu holds: cut, copy, paste and select all, and
/// nothing that sends its text out of the app (lifecycle 10.2; the coordinator's decisions on review
/// findings PP-3 and C-2). The platforms' Share, Search Web and Look Up, Android's text-processing
/// apps (a translator) and iOS's Live Text are left out.
const privateMenuItems = {
  ContextMenuButtonType.cut,
  ContextMenuButtonType.copy,
  ContextMenuButtonType.paste,
  ContextMenuButtonType.selectAll,
};

/// What a private box says once its text was copied, for as long as the copy lasts.
final copiedPrivately = 'Copied. It clears in ${secureCopyLifetime.inSeconds} seconds.';

/// What it says when the phone would not copy it privately: nothing went anywhere.
const notCopiedPrivately = 'Nothing was copied: this phone couldn’t copy it privately.';

/// A box that takes a patient's details or a note's text (`PhiField`, the birth field, every box
/// built on them): [builder] draws the box with [PrivateBoxState.menu] as its selection menu. Its
/// Copy and Cut, from the menu and from the keyboard alike (the copy and cut text intent), go
/// through [secureCopy], never the platform's general pasteboard: on iOS a local-only item, never
/// Universal Clipboard, on Android a clip marked sensitive with a label naming no one, each gone
/// after a minute (the coordinator's decision on review finding C-4). Cut takes the text out only
/// once it was copied; when the phone won't copy privately nothing is copied and the box says so
/// in a plain sentence, with no fallback to the plain clipboard. Each copy is said under the box as
/// a live region, a new one at every copy, so the same sentence twice is read twice. Paste is the
/// platform's own.
class PrivateBox extends StatefulWidget {
  const PrivateBox({super.key, required this.controller, required this.builder, this.onChanged});

  final TextEditingController controller;

  /// What the box's own change does, called after a cut, as a typed change calls it.
  final ValueChanged<String>? onChanged;
  final Widget Function(BuildContext context, EditableTextContextMenuBuilder menu) builder;

  @override
  State<PrivateBox> createState() => PrivateBoxState();
}

class PrivateBoxState extends State<PrivateBox> {
  String? _said;
  int _copies = 0;
  Timer? _clears;

  @override
  void dispose() {
    _clears?.cancel();
    super.dispose();
  }

  /// The box's selection menu: the platform's own items in [privateMenuItems], Copy and Cut through
  /// [secureCopy].
  Widget menu(BuildContext context, EditableTextState state) => AdaptiveTextSelectionToolbar.buttonItems(
    anchors: state.contextMenuAnchors,
    buttonItems: [
      for (final item in state.contextMenuButtonItems)
        if (item.type == ContextMenuButtonType.copy || item.type == ContextMenuButtonType.cut)
          ContextMenuButtonItem(
            type: item.type,
            label: item.label,
            onPressed: () {
              state.hideToolbar();
              unawaited(_copy(state, cut: item.type == ContextMenuButtonType.cut));
            },
          )
        else if (privateMenuItems.contains(item.type))
          item,
    ],
  );

  /// Copies the selection privately; a cut then takes it out, if the text is still as it was.
  Future<void> _copy(EditableTextState? state, {required bool cut}) async {
    final value = widget.controller.value;
    final selection = value.selection;
    if (!selection.isValid || selection.isCollapsed) return;
    final copied = await secureCopy(selection.textInside(value.text));
    if (!mounted) return;
    if (copied && cut && widget.controller.value == value) {
      final left = TextEditingValue(
        text: selection.textBefore(value.text) + selection.textAfter(value.text),
        selection: TextSelection.collapsed(offset: selection.start),
      );
      if (state != null && state.mounted) {
        state.userUpdateTextEditingValue(left, SelectionChangedCause.toolbar);
      } else {
        widget.controller.value = left;
        widget.onChanged?.call(left.text);
      }
    }
    _clears?.cancel();
    setState(() {
      _said = copied ? copiedPrivately : notCopiedPrivately;
      _copies++;
    });
    if (copied) _clears = Timer(secureCopyLifetime, () => mounted ? setState(() => _said = null) : null);
  }

  @override
  Widget build(BuildContext context) => Actions(
    // EditableText's copy and cut are overridable (Action.overridable): this takes the keyboard's.
    actions: {
      CopySelectionTextIntent: CallbackAction<CopySelectionTextIntent>(
        onInvoke: (intent) {
          final state = primaryFocus?.context?.findAncestorStateOfType<EditableTextState>();
          unawaited(_copy(state, cut: intent.collapseSelection));
          return null;
        },
      ),
    },
    child: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        widget.builder(context, menu),
        if (_said case final said?)
          Padding(
            key: ValueKey('private.copied.$_copies'),
            padding: const EdgeInsets.only(top: FieldSpace.s1),
            child: Semantics(liveRegion: true, container: true, child: Text(said)),
          ),
      ],
    ),
  );
}
