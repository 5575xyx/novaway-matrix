$ErrorActionPreference = "Stop"

$powerpoint = New-Object -ComObject PowerPoint.Application

try {
  foreach ($trigger in @(1, 2, 3)) {
    $presentation = $powerpoint.Presentations.Add($false)
    $slide = $presentation.Slides.Add(1, 12)
    $slide.SlideShowTransition.EntryEffect = 1793
    $textbox1 = $slide.Shapes.AddTextbox(1, 72, 72, 600, 200)
    $textbox1.TextFrame.TextRange.Text = "Animated title"
    $textbox2 = $slide.Shapes.AddTextbox(1, 72, 360, 600, 200)
    $textbox2.TextFrame.TextRange.Text = "Animated card"
    $targets = @($textbox1, $textbox2)

    for ($index = 0; $index -lt $targets.Count; $index++) {
      $effectId = 10
      if ($index -eq 0) { $effectId = 22 }
      $effect = $slide.TimeLine.MainSequence.AddEffect($targets[$index], $effectId, 0)
      $effect.Timing.TriggerType = $trigger
      $effect.Timing.Duration = 0.4
    }

    $output = "E:\AImoney\NovaWay-Matrix\novaway-coder\.tmp\animation-reference-$trigger.pptx"
    $presentation.SaveCopyAs($output)
    $presentation.Close()
    Write-Output "created $output"
  }
}
finally {
  $powerpoint.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($powerpoint) | Out-Null
}

Write-Output "created $output"
