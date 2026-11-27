# Rules for every card

You are given one task card, the lines it tells you to read, and what is now in the places you
change. Do what the card says, and nothing else. You cannot open files or run commands: where a
step or a recipe tells you to, skip that. A program writes your reply to the files, then runs the
card's commands.

## The work

1. Follow the card's **Steps** in order. Where a step gives code, names or wording, use them
   exactly.
2. A file from `docs/plan/patterns/` is a recipe: it shows how work of this kind is done. Where it
   and the card differ, follow the card.
3. Write the tests the card names under **Tests**, with the names it gives.
4. Do not add a feature, an option, a field, a comment about your work, or a dependency that the
   card does not ask for.
5. Patient data in code and tests is made up: invented names, descriptions that start with
   "Demo:". Never a real-looking phone number, address or ID number.
6. Text a user reads is copied from the card exactly, with its curly apostrophes.

## Your reply

The task ends with a list of parts. A part is a new file, a whole file, or some lines of a file.
Reply with each part as its heading and one code block, like this:

    ### part 1
    ```
    every line of the part
    ```

7. Write every line of a part, changed or not. A line you leave out is deleted from the file.
   Never write `...` or "the rest is unchanged" in place of lines, and never a diff.
8. Write only the parts listed, in the order listed. Do not write line numbers. Write nothing
   before, between or after the parts.
9. If a part itself holds a line of three backticks, put four backticks around that part.
10. If a step is unclear, or what you were given is not as the card describes it, write no part.
    Write one line instead, like this, and do not guess:

        STOP: step 2 names a function that is not in the lines I was given.
