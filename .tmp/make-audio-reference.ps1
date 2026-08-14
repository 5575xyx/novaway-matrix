$ErrorActionPreference = "Stop"

$audio = "E:\AImoney\NovaWay-Matrix\novaway-coder\.tmp\test-audio.wav"
$output = "E:\AImoney\NovaWay-Matrix\novaway-coder\.tmp\audio-reference.pptx"
$powerpoint = New-Object -ComObject PowerPoint.Application

try {
  $presentation = $powerpoint.Presentations.Add($false)
  $slide = $presentation.Slides.Add(1, 12)
  $audioShape = $null
  try {
    $audioShape = $slide.Shapes.AddMediaObject2($audio, $false, $true, 72, 72, 200, 200)
  }
  catch {
    $audioShape = $slide.Shapes.AddMediaObject($audio, $false, $true, 72, 72, 200, 200)
  }
  $audioShape.AnimationSettings.PlaySettings.PlayOnEntry = $true
  $audioShape.AnimationSettings.PlaySettings.PauseAnimation = $false
  $audioShape.AnimationSettings.PlaySettings.StopAfterSlides = 1

  $presentation.SaveCopyAs($output)
  $presentation.Close()
  Write-Output "created $output"
}
finally {
  $powerpoint.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($powerpoint) | Out-Null
}
