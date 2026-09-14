on run argv
  set inPath to item 1 of argv
  set pdfPath to item 2 of argv
  tell application "Microsoft PowerPoint"
    open (POSIX file inPath)
    delay 3
    set p to active presentation
    set n to count of slides of p
    save p in (POSIX file pdfPath) as save as PDF
    close p saving no
  end tell
  return n
end run
