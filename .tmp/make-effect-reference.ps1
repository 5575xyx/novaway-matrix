$ErrorActionPreference = "Stop"

$powerpoint = New-Object -ComObject PowerPoint.Application

try {
  foreach ($effectId in @(2, 10, 22, 23)) {
    $presentation = $powerpoint.Presentations.Add($false)
    $slide = $presentation.Slides.Add(1, 12)
    $textbox = $slide.Shapes.AddTextbox(1, 72, 72, 600, 200)
    $textbox.TextFrame.TextRange.Text = "Animated $effectId"
    $effect = $slide.TimeLine.MainSequence.AddEffect($textbox, $effectId, 0)
    $effect.Timing.TriggerType = 3
    $effect.Timing.Duration = 0.5

    $output = "E:\AImoney\NovaWay-Matrix\novaway-coder\.tmp\effect-$effectId-reference.pptx"
    $presentation.SaveCopyAs($output)
    $presentation.Close()
    Write-Output "created $output"
  }
}
finally {
  $powerpoint.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($powerpoint) | Out-Null
}
